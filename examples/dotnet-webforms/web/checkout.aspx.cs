namespace App.Web
{
    public partial class Checkout : CheckoutBasePage
    {
        protected void Page_Load(object sender, EventArgs e)
        {
            Logger.LogInformation("checkout opened");
        }
    }
}
